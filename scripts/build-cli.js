#!/usr/bin/env node
/**
 * Compile the `vault` CLI into standalone, single-file executables that run
 * without Node installed. Uses Bun's `--compile` cross-compiler so every
 * target can be produced from a single machine.
 *
 * Requires Bun (https://bun.sh). In CI this is provided by oven-sh/setup-bun.
 * Run locally with: npm run package:cli
 */
import { spawnSync } from 'child_process';
import { mkdirSync, existsSync } from 'fs';
import path from 'path';

const ENTRY = 'bin/cli.js';
const OUT_DIR = 'dist-cli';

// Bun compile target -> output filename.
const TARGETS = [
  ['bun-linux-x64', 'vault-linux-x64'],
  ['bun-linux-arm64', 'vault-linux-arm64'],
  ['bun-darwin-x64', 'vault-macos-x64'],
  ['bun-darwin-arm64', 'vault-macos-arm64'],
  ['bun-windows-x64', 'vault-windows-x64.exe'],
];

function hasBun() {
  const r = spawnSync('bun', ['--version'], { encoding: 'utf-8' });
  return r.status === 0;
}

if (!hasBun()) {
  console.error(
    'Bun is required to build standalone CLI binaries.\n' +
      'Install it from https://bun.sh, then re-run: npm run package:cli'
  );
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

let failed = false;
for (const [target, outName] of TARGETS) {
  const outfile = path.join(OUT_DIR, outName);
  console.log(`\n→ Building ${outName} (${target})`);
  const r = spawnSync(
    'bun',
    [
      'build',
      ENTRY,
      '--compile',
      '--minify',
      `--target=${target}`,
      '--outfile',
      outfile,
    ],
    { stdio: 'inherit' }
  );
  if (r.status !== 0) {
    console.error(`✗ Failed to build ${outName}`);
    failed = true;
  } else if (existsSync(outfile) || existsSync(`${outfile}.exe`)) {
    console.log(`✓ ${outfile}`);
  }
}

process.exit(failed ? 1 : 0);
