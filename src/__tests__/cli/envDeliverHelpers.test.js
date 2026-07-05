// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import {
  DEFAULT_FILE_MODE,
  parseFileMode,
  decodeValue,
  encodeValue,
  writeArtifact,
  normalizeDeliverEntry,
  normalizeManifest,
  renderDeliverEntry,
} from '../../../bin/commands/envDeliverHelpers.js';

describe('parseFileMode', () => {
  it('defaults to 0600 for null/undefined', () => {
    expect(parseFileMode()).toBe(0o600);
    expect(parseFileMode(null)).toBe(DEFAULT_FILE_MODE);
  });

  it('parses 3- and 4-digit octal strings', () => {
    expect(parseFileMode('600')).toBe(0o600);
    expect(parseFileMode('0600')).toBe(0o600);
    expect(parseFileMode('0644')).toBe(0o644);
    expect(parseFileMode('0o600')).toBe(0o600);
  });

  it('passes a number through unchanged', () => {
    expect(parseFileMode(0o640)).toBe(0o640);
  });

  it('throws on non-octal input', () => {
    expect(() => parseFileMode('rwx')).toThrow(/Invalid file mode/);
    expect(() => parseFileMode('0999')).toThrow(/Invalid file mode/);
    expect(() => parseFileMode('12')).toThrow(/Invalid file mode/);
  });
});

describe('decodeValue', () => {
  it('returns the raw string when no decode is requested', () => {
    expect(decodeValue('plain')).toBe('plain');
    expect(decodeValue(null)).toBe('');
    expect(decodeValue(undefined)).toBe('');
  });

  it('base64-decodes to a Buffer that round-trips', () => {
    const encoded = Buffer.from('binary\x00data', 'utf-8').toString('base64');
    const out = decodeValue(encoded, 'base64');
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(String(out)).toBe('binary\x00data');
  });

  it('throws on an unknown decode', () => {
    expect(() => decodeValue('x', 'rot13')).toThrow(/Unknown decode "rot13"/);
  });
});

describe('encodeValue', () => {
  it('returns UTF-8 text when no encoding is requested', () => {
    expect(encodeValue('plain')).toBe('plain');
    expect(encodeValue(Buffer.from('buf'))).toBe('buf');
    expect(encodeValue(null)).toBe('');
  });

  it('base64-encodes a Buffer of binary bytes', () => {
    const bytes = Buffer.from([0x00, 0xff, 0x10]);
    expect(encodeValue(bytes, 'base64')).toBe(bytes.toString('base64'));
  });

  it('base64-encodes a string via its UTF-8 bytes', () => {
    expect(encodeValue('hello', 'base64')).toBe('aGVsbG8=');
  });

  it('round-trips with decodeValue', () => {
    const bytes = Buffer.from('secret\x00blob');
    const stored = encodeValue(bytes, 'base64');
    const back = decodeValue(stored, 'base64');
    // Buffer.isBuffer narrows the string|Buffer union for both TS and runtime.
    expect(Buffer.isBuffer(back) && back.equals(bytes)).toBe(true);
  });

  it('throws on an unknown encoder', () => {
    expect(() => encodeValue('x', 'rot13')).toThrow(/Unknown encode "rot13"/);
  });
});

describe('writeArtifact', () => {
  let dir;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-deliver-test-'));
  });

  afterEach(async () => {
    await fs.remove(dir);
  });

  it('creates missing parent directories and writes content', async () => {
    const out = path.join(dir, 'nested/deep/secret.txt');
    await writeArtifact(out, 'hello');
    expect(await fs.readFile(out, 'utf-8')).toBe('hello');
  });

  it('writes at mode 0600 by default', async () => {
    const out = path.join(dir, 'a.txt');
    await writeArtifact(out, 'x');
    // eslint-disable-next-line no-bitwise
    expect((await fs.stat(out)).mode & 0o777).toBe(0o600);
  });

  it('enforces the requested mode even when overwriting a wider-permission file', async () => {
    const out = path.join(dir, 'b.txt');
    await fs.writeFile(out, 'old', { mode: 0o644 });
    await writeArtifact(out, 'new', { mode: 0o600 });
    expect(await fs.readFile(out, 'utf-8')).toBe('new');
    // eslint-disable-next-line no-bitwise
    expect((await fs.stat(out)).mode & 0o777).toBe(0o600);
  });

  it('writes decoded binary content byte-for-byte', async () => {
    const out = path.join(dir, 'bin');
    const bytes = Buffer.from([0x00, 0xff, 0x10, 0x7f]);
    await writeArtifact(out, bytes);
    const read = await fs.readFile(out);
    expect(read.equals(bytes)).toBe(true);
  });
});

describe('normalizeDeliverEntry', () => {
  it('normalizes a format entry with an optional keys subset', () => {
    const e = normalizeDeliverEntry({
      path: '.env',
      format: 'dotenv',
      keys: ['A', 'B'],
    });
    expect(e).toMatchObject({
      kind: 'format',
      path: '.env',
      format: 'dotenv',
      keys: ['A', 'B'],
      mode: 0o600,
    });
  });

  it('normalizes a from (blob) entry with decode', () => {
    const e = normalizeDeliverEntry({
      path: 'ios/GoogleService-Info.plist',
      from: 'GOOGLE_PLIST',
      decode: 'base64',
    });
    expect(e).toMatchObject({
      kind: 'from',
      from: 'GOOGLE_PLIST',
      decode: 'base64',
    });
  });

  it('derives a template out path by stripping .vtpl', () => {
    const e = normalizeDeliverEntry({ template: 'ios/Secrets.xcconfig.vtpl' });
    expect(e).toMatchObject({
      kind: 'template',
      template: 'ios/Secrets.xcconfig.vtpl',
      path: 'ios/Secrets.xcconfig',
    });
  });

  it('honors an explicit out for a non-.vtpl template', () => {
    const e = normalizeDeliverEntry({
      template: 'tpl/foo',
      out: 'build/foo.conf',
    });
    expect(e.path).toBe('build/foo.conf');
  });

  it('parses a per-entry mode', () => {
    expect(
      normalizeDeliverEntry({ path: 'x', from: 'K', mode: '0644' }).mode
    ).toBe(0o644);
  });

  it('rejects entries without exactly one kind field', () => {
    expect(() => normalizeDeliverEntry({ path: 'x' }, 3)).toThrow(
      /deliver\[3\]: exactly one of/
    );
    expect(() =>
      normalizeDeliverEntry({ path: 'x', format: 'dotenv', from: 'K' })
    ).toThrow(/exactly one of/);
  });

  it('rejects an unknown format, unknown decode, and non-.vtpl template without out', () => {
    expect(() => normalizeDeliverEntry({ path: 'x', format: 'yaml' })).toThrow(
      /unknown format "yaml"/
    );
    expect(() =>
      normalizeDeliverEntry({ path: 'x', from: 'K', decode: 'rot13' })
    ).toThrow(/unknown decode "rot13"/);
    expect(() => normalizeDeliverEntry({ template: 'plain.conf' })).toThrow(
      /no .vtpl suffix/
    );
  });
});

describe('normalizeManifest', () => {
  it('returns an empty list when there is no deliver key', () => {
    expect(normalizeManifest({ env: 'dev' })).toEqual({
      env: 'dev',
      entries: [],
    });
  });

  it('throws when deliver is not an array', () => {
    expect(() => normalizeManifest({ deliver: {} })).toThrow(
      /"deliver" must be an array/
    );
  });

  it('normalizes every entry and surfaces the offending index', () => {
    expect(() =>
      normalizeManifest({
        deliver: [{ path: '.env', format: 'dotenv' }, { path: 'x' }],
      })
    ).toThrow(/deliver\[1\]/);
  });
});

describe('renderDeliverEntry', () => {
  const vars = {
    A: '1',
    B: 'two',
    GOOGLE: Buffer.from('blob').toString('base64'),
  };
  const noTemplates = () => {
    throw new Error('should not read a template');
  };

  it('renders a full dotenv format entry', () => {
    const e = normalizeDeliverEntry({ path: '.env', format: 'dotenv' });
    expect(renderDeliverEntry(e, vars, noTemplates)).toBe(
      `A=1\nB=two\nGOOGLE=${vars.GOOGLE}\n`
    );
  });

  it('renders only the requested keys subset', () => {
    const e = normalizeDeliverEntry({
      path: '.env',
      format: 'dotenv',
      keys: ['A'],
    });
    expect(renderDeliverEntry(e, vars, noTemplates)).toBe('A=1\n');
  });

  it('renders a json format entry', () => {
    const e = normalizeDeliverEntry({
      path: 'c.json',
      format: 'json',
      keys: ['A', 'B'],
    });
    expect(
      JSON.parse(String(renderDeliverEntry(e, vars, noTemplates)))
    ).toEqual({
      A: '1',
      B: 'two',
    });
  });

  it('renders a from blob, base64-decoded to a Buffer', () => {
    const e = normalizeDeliverEntry({
      path: 'g',
      from: 'GOOGLE',
      decode: 'base64',
    });
    const out = renderDeliverEntry(e, vars, noTemplates);
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(String(out)).toBe('blob');
  });

  it('renders a template via the injected reader', () => {
    const e = normalizeDeliverEntry({ template: 'x.conf.vtpl' });
    const read = () => 'url={{A}} name={{B}}';
    expect(renderDeliverEntry(e, vars, read)).toBe('url=1 name=two');
  });

  it('throws when a from variable is missing', () => {
    const e = normalizeDeliverEntry({ path: 'g', from: 'NOPE' });
    expect(() => renderDeliverEntry(e, vars, noTemplates)).toThrow(
      /variable "NOPE" not found/
    );
  });

  it('throws when a subset key is missing', () => {
    const e = normalizeDeliverEntry({
      path: '.env',
      format: 'dotenv',
      keys: ['ZZ'],
    });
    expect(() => renderDeliverEntry(e, vars, noTemplates)).toThrow(
      /key "ZZ" not found/
    );
  });
});
