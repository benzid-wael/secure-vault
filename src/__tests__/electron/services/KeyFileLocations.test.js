// @vitest-environment node
// Where each vault's key file was last used (New-54, step 4).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { KeyFileLocations } from '../../../electron/services/KeyFileLocations.js';

let dir;
let file;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-key-locations-'));
  file = path.join(dir, 'data', 'key-file-locations.json');
});
afterEach(() => fs.remove(dir));

const at = (...parts) => path.join(dir, ...parts);

describe('KeyFileLocations', () => {
  it('remembers a location per vault across runs, 0600', async () => {
    const locations = new KeyFileLocations({ file });
    expect(locations.get(at('v', 'team.vault'))).toBeNull();
    await locations.set(at('v', 'team.vault'), at('usb', 'team.svkey'));
    await locations.set(at('v', 'team.vault'), at('usb', 'team.svkey')); // no-op
    expect(locations.get(at('v', '..', 'v', 'team.vault'))).toBe(
      at('usb', 'team.svkey')
    );
    expect(new KeyFileLocations({ file }).get(at('v', 'team.vault'))).toBe(
      at('usb', 'team.svkey')
    );
    if (process.platform !== 'win32') {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
    // Locations only: nothing of a key file's content.
    expect(Object.keys(fs.readJsonSync(file))).toEqual([at('v', 'team.vault')]);
  });

  it('forgets a location, once', async () => {
    const locations = new KeyFileLocations({ file });
    await locations.set(at('v', 'a.vault'), at('k', 'a.svkey'));
    await locations.set(at('v', 'b.vault'), at('k', 'b.svkey'));
    await locations.forget(at('v', 'a.vault'));
    await locations.forget(at('v', 'a.vault'));
    expect(locations.get(at('v', 'a.vault'))).toBeNull();
    expect(new KeyFileLocations({ file }).get(at('v', 'b.vault'))).toBe(
      at('k', 'b.svkey')
    );
  });

  it('keeps only absolute paths from the file, and starts empty when damaged', async () => {
    await fs.outputJson(file, {
      [at('ok.vault')]: at('ok.svkey'),
      'relative.vault': at('x.svkey'),
      [at('rel-key.vault')]: 'relative.svkey',
      [at('num.vault')]: 4,
    });
    const locations = new KeyFileLocations({ file });
    expect(locations.get(at('ok.vault'))).toBe(at('ok.svkey'));
    expect(locations.get(at('rel-key.vault'))).toBeNull();
    expect(locations.get(at('num.vault'))).toBeNull();
    for (const content of ['not json', '[1, 2]', 'null']) {
      await fs.outputFile(file, content);
      expect(new KeyFileLocations({ file }).get(at('ok.vault'))).toBeNull();
    }
  });
});
