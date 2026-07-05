// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '../../../bin/cli.js');
const NODE = process.execPath;
const PASSWORD = 'TestVault123!@#';

let vaultPath;
let workDir;

function cli(args, extraEnv = {}) {
  return spawnSync(NODE, [CLI, 'env', ...args], {
    encoding: 'utf8',
    env: { ...process.env, VAULT_ENV_PASSWORD: PASSWORD, ...extraEnv },
  });
}

const PLIST_BYTES = Buffer.from('<plist>binary\x00data</plist>', 'utf-8');

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-file-'));
  vaultPath = path.join(workDir, 'test.env.vault');
  cli(['init', '-v', vaultPath]);
  cli([
    'set',
    'API_URL',
    'https://api.example.com',
    '-e',
    'dev',
    '-v',
    vaultPath,
  ]);
  // A binary file secret stored base64-encoded, the way Firebase/keystore
  // secrets live in the vault.
  cli([
    'set',
    'GOOGLE_PLIST',
    PLIST_BYTES.toString('base64'),
    '-e',
    'dev',
    '-v',
    vaultPath,
  ]);
});

afterAll(() => {
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('vault env file (integration)', () => {
  it('materializes a plain var at mode 0600 by default', () => {
    const out = path.join(workDir, 'plain.txt');
    const r = cli([
      'file',
      'API_URL',
      '--out',
      out,
      '-e',
      'dev',
      '-v',
      vaultPath,
    ]);
    expect(r.status).toBe(0);
    expect(fs.readFileSync(out, 'utf-8')).toBe('https://api.example.com');
    // eslint-disable-next-line no-bitwise
    expect(fs.statSync(out).mode & 0o777).toBe(0o600);
  });

  it('base64-decodes a binary secret byte-for-byte', () => {
    const out = path.join(workDir, 'ios/GoogleService-Info.plist');
    const r = cli([
      'file',
      'GOOGLE_PLIST',
      '--out',
      out,
      '--decode',
      'base64',
      '-e',
      'dev',
      '-v',
      vaultPath,
    ]);
    expect(r.status).toBe(0);
    // parent dir was created
    expect(fs.readFileSync(out).equals(PLIST_BYTES)).toBe(true);
  });

  it('honors an explicit --mode', () => {
    const out = path.join(workDir, 'moded.txt');
    const r = cli([
      'file',
      'API_URL',
      '--out',
      out,
      '--mode',
      '0640',
      '-e',
      'dev',
      '-v',
      vaultPath,
    ]);
    expect(r.status).toBe(0);
    // eslint-disable-next-line no-bitwise
    expect(fs.statSync(out).mode & 0o777).toBe(0o640);
  });

  it('fails (non-zero) on an undefined key without writing a file', () => {
    const out = path.join(workDir, 'missing.txt');
    const r = cli(['file', 'NOPE', '--out', out, '-e', 'dev', '-v', vaultPath]);
    expect(r.status).not.toBe(0);
    expect(fs.existsSync(out)).toBe(false);
  });

  it('fails fast on an invalid --mode', () => {
    const out = path.join(workDir, 'badmode.txt');
    const r = cli([
      'file',
      'API_URL',
      '--out',
      out,
      '--mode',
      'rwx',
      '-e',
      'dev',
      '-v',
      vaultPath,
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Invalid file mode/);
    expect(fs.existsSync(out)).toBe(false);
  });
});

describe('vault env set --in / --encode (blob ingestion)', () => {
  it('ingests a binary file as base64 and round-trips via env file --decode', () => {
    const src = path.join(workDir, 'src-keystore.bin');
    const original = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x7f]);
    fs.writeFileSync(src, original);

    const setR = cli([
      'set',
      'KEYSTORE',
      '--in',
      src,
      '--encode',
      'base64',
      '-e',
      'dev',
      '-v',
      vaultPath,
    ]);
    expect(setR.status).toBe(0);

    // Stored value is the base64 text.
    const getR = cli(['get', 'KEYSTORE', '-e', 'dev', '-v', vaultPath]);
    expect(getR.stdout.trim()).toBe(original.toString('base64'));

    // Materialize it back and confirm byte-for-byte fidelity.
    const out = path.join(workDir, 'out-keystore.bin');
    const fileR = cli([
      'file',
      'KEYSTORE',
      '--out',
      out,
      '--decode',
      'base64',
      '-e',
      'dev',
      '-v',
      vaultPath,
    ]);
    expect(fileR.status).toBe(0);
    expect(fs.readFileSync(out).equals(original)).toBe(true);
  });

  it('ingests a text file without encoding', () => {
    const src = path.join(workDir, 'note.txt');
    fs.writeFileSync(src, 'line1\nline2\n');
    const r = cli(['set', 'NOTE', '--in', src, '-e', 'dev', '-v', vaultPath]);
    expect(r.status).toBe(0);
    const getR = cli(['get', 'NOTE', '-e', 'dev', '-v', vaultPath]);
    expect(getR.stdout).toContain('line1');
  });

  it('rejects passing both a value and --in', () => {
    const src = path.join(workDir, 'note.txt');
    const r = cli([
      'set',
      'X',
      'inline',
      '--in',
      src,
      '-e',
      'dev',
      '-v',
      vaultPath,
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/either a value argument or --in/);
  });

  it('fails fast on an unknown --encode', () => {
    const r = cli([
      'set',
      'X',
      'v',
      '--encode',
      'rot13',
      '-e',
      'dev',
      '-v',
      vaultPath,
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Unknown encode "rot13"/);
  });

  it('errors clearly when --in points at a missing file', () => {
    const r = cli([
      'set',
      'X',
      '--in',
      path.join(workDir, 'nope.bin'),
      '-e',
      'dev',
      '-v',
      vaultPath,
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Cannot read --in file/);
  });
});
