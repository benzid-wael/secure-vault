// Coverage of chosen files, paths the coverage config excludes included
// (GUI-ENV-BREAKDOWN New-7):
//
//   npm run coverage:files -- <file> [<file> …] [--related]
//
// Runs the whole suite (or, with --related, only the tests that import the
// files) with coverage scoped to those files and no thresholds, and prints
// one row per file. The report goes to a temp directory: ./coverage and
// `npm run test:coverage` are untouched. Exits non-zero if a test fails.
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const related = args.includes('--related');
const files = args.filter((arg) => arg !== '--related');

if (files.length === 0) {
  console.error(
    'Usage: npm run coverage:files -- <file> [<file> …] [--related]'
  );
  process.exit(2);
}
const missing = files.filter((file) => !fs.existsSync(path.resolve(file)));
if (missing.length > 0) {
  console.error(`No such file: ${missing.join(', ')}`);
  process.exit(2);
}

const relative = files.map((file) =>
  path.relative(REPO, path.resolve(file)).split(path.sep).join('/')
);
const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-coverage-'));
const run = spawnSync(
  process.execPath,
  [
    path.join(REPO, 'node_modules/vitest/vitest.mjs'),
    ...(related ? ['related', ...relative] : []),
    '--run',
    '--reporter=dot',
    '--coverage.enabled',
    // Replaces the config's exclude list, which hides src/electron/** etc.
    '--coverage.exclude=**/node_modules/**',
    ...relative.map((file) => `--coverage.include=${file}`),
    '--coverage.reporter=json-summary',
    `--coverage.reportsDirectory=${reportsDir}`,
    ...['lines', 'functions', 'branches', 'statements'].map(
      (metric) => `--coverage.thresholds.${metric}=0`
    ),
  ],
  { cwd: REPO, stdio: 'inherit' }
);

const summaryPath = path.join(reportsDir, 'coverage-summary.json');
const summary = fs.existsSync(summaryPath)
  ? JSON.parse(fs.readFileSync(summaryPath, 'utf8'))
  : {};
fs.rmSync(reportsDir, { recursive: true, force: true });

const pct = (metric) =>
  metric ? `${metric.pct}% (${metric.covered}/${metric.total})` : '—';
console.log('\nfile | lines | functions | branches');
for (const file of relative) {
  const row = summary[path.join(REPO, file)];
  console.log(
    row
      ? `${file} | ${pct(row.lines)} | ${pct(row.functions)} | ${pct(row.branches)}`
      : `${file} | not loaded by any test`
  );
}
process.exit(run.status ?? 1);
