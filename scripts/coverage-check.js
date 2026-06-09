#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Custom coverage checker that displays nice coverage information
 * and enforces coverage thresholds for pre-commit hooks
 */

// Recalibrated for vitest 4: its v8 provider switched to AST-aware remapping,
// which reports ~11 points lower than vitest 1's v8-to-istanbul mapping on the
// same tests. Coverage did not regress — the measurement got stricter. Keep
// these in sync with the `thresholds` block in vite.config.js.
const COVERAGE_THRESHOLDS = {
  lines: 68,
  functions: 60,
  statements: 67,
  branches: 64,
};

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function colorize(text, color) {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

function getPercentageColor(percentage, threshold) {
  if (percentage >= threshold) return 'green';
  if (percentage >= threshold - 10) return 'yellow';
  return 'red';
}

function formatPercentage(percentage, threshold) {
  const color = getPercentageColor(percentage, threshold);
  return colorize(`${percentage.toFixed(1)}%`, color);
}

function displayCoverageHeader() {
  console.log('');
  console.log(colorize('📊 TEST COVERAGE REPORT', 'cyan'));
  console.log(colorize('========================', 'cyan'));
  console.log('');
}

function displayCoverageSummary(coverage) {
  const { lines, functions, statements, branches } = coverage.total;

  console.log(colorize('Coverage Summary:', 'bright'));
  console.log('');

  const metrics = [
    { name: 'Lines', value: lines.pct, threshold: COVERAGE_THRESHOLDS.lines },
    {
      name: 'Functions',
      value: functions.pct,
      threshold: COVERAGE_THRESHOLDS.functions,
    },
    {
      name: 'Statements',
      value: statements.pct,
      threshold: COVERAGE_THRESHOLDS.statements,
    },
    {
      name: 'Branches',
      value: branches.pct,
      threshold: COVERAGE_THRESHOLDS.branches,
    },
  ];

  metrics.forEach(({ name, value, threshold }) => {
    const percentage = formatPercentage(value, threshold);
    const status = value >= threshold ? '✅' : '❌';
    console.log(
      `  ${status} ${name.padEnd(12)}: ${percentage} (threshold: ${threshold}%)`
    );
  });

  console.log('');
}

function checkThresholds(coverage) {
  const { lines, functions, statements, branches } = coverage.total;
  const failures = [];

  if (lines.pct < COVERAGE_THRESHOLDS.lines) {
    failures.push(
      `Lines: ${lines.pct.toFixed(1)}% < ${COVERAGE_THRESHOLDS.lines}%`
    );
  }
  if (functions.pct < COVERAGE_THRESHOLDS.functions) {
    failures.push(
      `Functions: ${functions.pct.toFixed(1)}% < ${COVERAGE_THRESHOLDS.functions}%`
    );
  }
  if (statements.pct < COVERAGE_THRESHOLDS.statements) {
    failures.push(
      `Statements: ${statements.pct.toFixed(1)}% < ${COVERAGE_THRESHOLDS.statements}%`
    );
  }
  if (branches.pct < COVERAGE_THRESHOLDS.branches) {
    failures.push(
      `Branches: ${branches.pct.toFixed(1)}% < ${COVERAGE_THRESHOLDS.branches}%`
    );
  }

  return failures;
}

function displayResults(coverage) {
  const failures = checkThresholds(coverage);

  if (failures.length === 0) {
    console.log(colorize('🎉 All coverage thresholds met!', 'green'));
    console.log('');
    return true;
  } else {
    console.log(colorize('❌ Coverage thresholds not met:', 'red'));
    failures.forEach((failure) => {
      console.log(colorize(`   ${failure}`, 'red'));
    });
    console.log('');
    console.log(
      colorize('Please add more tests to improve coverage.', 'yellow')
    );
    console.log('');
    return false;
  }
}

async function main() {
  try {
    displayCoverageHeader();

    // Run tests with coverage
    console.log('Running tests with coverage...');
    console.log('');

    execSync('npm run test:coverage', {
      stdio: 'inherit',
      cwd: process.cwd(),
    });

    // Read coverage results
    const coveragePath = path.join(
      process.cwd(),
      'coverage',
      'coverage-summary.json'
    );

    if (!fs.existsSync(coveragePath)) {
      console.log(
        colorize(
          '❌ Coverage file not found. Make sure tests ran successfully.',
          'red'
        )
      );
      process.exit(1);
    }

    const coverageData = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));

    displayCoverageSummary(coverageData);

    const success = displayResults(coverageData);

    if (!success) {
      process.exit(1);
    }
  } catch (error) {
    console.error(colorize('❌ Error running coverage check:', 'red'));
    console.error(error.message);
    process.exit(1);
  }
}

main();
