#!/usr/bin/env node

/**
 * Test Summary Script
 * Provides an overview of test coverage and status
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const testFiles = [
  // Component Tests
  'src/__tests__/App.test.jsx',
  'src/__tests__/main.test.jsx',
  'src/__tests__/components/VaultSelector.test.jsx',
  'src/__tests__/components/CreateVault.test.jsx',
  'src/__tests__/components/VaultLogin.test.jsx',
  'src/__tests__/components/PasswordManager.test.jsx',
  'src/__tests__/components/EntryDialog.test.jsx',
  'src/__tests__/components/Settings.test.jsx',
  'src/__tests__/components/SearchAndFilter.test.jsx',
  'src/__tests__/components/EntryList.test.jsx',

  // Hook Tests
  'src/__tests__/hooks/useEntryManagement.test.js',
  'src/__tests__/hooks/useSearchAndFilter.test.js',

  // Utility Tests
  'src/__tests__/utils/passwordGenerator.test.js',
  'src/__tests__/utils/passwordValidation.test.js',
  'src/__tests__/utils/categoryManager.test.js',

  // Integration Tests
  'src/__tests__/integration/VaultFlow.test.jsx',

  // Simple Tests
  'src/__tests__/simple.test.js',
  'src/__tests__/basic.test.js',
  'src/__tests__/working.test.js',
  'src/__tests__/components/SearchAndFilter.simple.test.js',
];

const sourceFiles = [
  // Main Files
  'src/App.jsx',
  'src/main.jsx',

  // Components
  'src/components/VaultSelector.jsx',
  'src/components/CreateVault.jsx',
  'src/components/VaultLogin.jsx',
  'src/components/PasswordManager.jsx',
  'src/components/EntryDialog.jsx',
  'src/components/Settings.jsx',
  'src/components/SearchAndFilter.jsx',
  'src/components/EntryList.jsx',

  // Hooks
  'src/hooks/useEntryManagement.js',
  'src/hooks/useSearchAndFilter.js',

  // Utils
  'src/utils/passwordGenerator.js',
  'src/utils/passwordValidation.js',
  'src/utils/categoryManager.js',
];

function checkFileExists(filePath) {
  return existsSync(filePath);
}

function countLines(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8');
    return content.split('\n').length;
  } catch (error) {
    return 0;
  }
}

function generateTestSummary() {
  console.log('🧪 Test Coverage Summary');
  console.log('========================\n');

  // Check test files
  console.log('📋 Test Files Status:');
  let totalTestFiles = 0;
  let existingTestFiles = 0;
  let totalTestLines = 0;

  testFiles.forEach((file) => {
    totalTestFiles++;
    const exists = checkFileExists(file);
    if (exists) {
      existingTestFiles++;
      const lines = countLines(file);
      totalTestLines += lines;
      console.log(`✅ ${file} (${lines} lines)`);
    } else {
      console.log(`❌ ${file} (missing)`);
    }
  });

  console.log(
    `\n📊 Test Files: ${existingTestFiles}/${totalTestFiles} (${Math.round((existingTestFiles / totalTestFiles) * 100)}%)`
  );
  console.log(`📏 Total Test Lines: ${totalTestLines}`);

  // Check source files
  console.log('\n📋 Source Files Coverage:');
  let totalSourceFiles = 0;
  let coveredSourceFiles = 0;
  let totalSourceLines = 0;

  sourceFiles.forEach((file) => {
    totalSourceFiles++;
    const exists = checkFileExists(file);
    if (exists) {
      const lines = countLines(file);
      totalSourceLines += lines;

      // Check if there's a corresponding test file
      const testFile = file
        .replace(/\.jsx?$/, '.test.jsx')
        .replace('src/', 'src/__tests__/');
      const hasTest = checkFileExists(testFile);

      if (hasTest) {
        coveredSourceFiles++;
        console.log(`✅ ${file} (${lines} lines) - Has tests`);
      } else {
        console.log(`⚠️  ${file} (${lines} lines) - No tests`);
      }
    } else {
      console.log(`❌ ${file} (missing)`);
    }
  });

  console.log(
    `\n📊 Source Coverage: ${coveredSourceFiles}/${totalSourceFiles} (${Math.round((coveredSourceFiles / totalSourceFiles) * 100)}%)`
  );
  console.log(`📏 Total Source Lines: ${totalSourceLines}`);

  // Test categories
  console.log('\n📂 Test Categories:');
  const categories = {
    'Component Tests': testFiles.filter((f) => f.includes('/components/'))
      .length,
    'Hook Tests': testFiles.filter((f) => f.includes('/hooks/')).length,
    'Utility Tests': testFiles.filter((f) => f.includes('/utils/')).length,
    'Integration Tests': testFiles.filter((f) => f.includes('/integration/'))
      .length,
    'Simple Tests': testFiles.filter(
      (f) =>
        f.includes('simple') || f.includes('basic') || f.includes('working')
    ).length,
    'Main App Tests': testFiles.filter(
      (f) => f.includes('App.test') || f.includes('main.test')
    ).length,
  };

  Object.entries(categories).forEach(([category, count]) => {
    console.log(`  ${category}: ${count} files`);
  });

  console.log('\n🎯 Coverage Goals:');
  console.log('  Target: 70% line coverage');
  console.log('  Target: 70% function coverage');
  console.log('  Target: 70% statement coverage');
  console.log('  Target: 70% branch coverage');

  console.log('\n🚀 Next Steps:');
  console.log('  1. Run: npm run test:coverage');
  console.log('  2. Check coverage report in coverage/index.html');
  console.log('  3. Add tests for any uncovered areas');
  console.log('  4. Ensure all tests pass');

  return {
    testFiles: { total: totalTestFiles, existing: existingTestFiles },
    sourceFiles: { total: totalSourceFiles, covered: coveredSourceFiles },
    testLines: totalTestLines,
    sourceLines: totalSourceLines,
  };
}

// Run the summary
if (import.meta.url === `file://${process.argv[1]}`) {
  generateTestSummary();
}

export { generateTestSummary };
