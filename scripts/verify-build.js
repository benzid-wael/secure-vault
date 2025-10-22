#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Check if we're in the project root
const projectRoot = path.resolve(__dirname, '..');
const buildDir = path.join(projectRoot, 'build');
const electronDir = path.join(buildDir, 'electron');

console.log('🔍 Verifying build setup...');

// Check if build directory exists
if (!fs.existsSync(buildDir)) {
  console.error('❌ Build directory not found. Run `npm run build` first.');
  process.exit(1);
}

// Check for required files
const requiredFiles = [
  'index.html',
  'static/js/main.js',
  'electron/main.js',
  'electron/preload.js',
];

let allFilesExist = true;

requiredFiles.forEach((file) => {
  const filePath = path.join(buildDir, file);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Missing required file: ${filePath}`);
    allFilesExist = false;
  } else {
    console.log(`✅ Found: ${file}`);
  }
});

if (!allFilesExist) {
  console.error(
    '\n❌ Some required files are missing from the build directory.'
  );
  console.log('\nTry running the following commands:');
  console.log('  1. npm run build');
  console.log('  2. npm run build:main');
  process.exit(1);
}

// Check for environment variables
console.log('\n🔍 Checking environment variables...');
const envVars = ['NODE_ENV'];
let envVarsValid = true;

envVars.forEach((envVar) => {
  if (!process.env[envVar]) {
    console.warn(`⚠️  Warning: ${envVar} is not set`);
    envVarsValid = false;
  } else {
    console.log(`✅ ${envVar}=${process.env[envVar]}`);
  }
});

// Check if Electron is installed
try {
  const electronVersion = execSync('electron --version', { stdio: 'pipe' })
    .toString()
    .trim();
  console.log(`\n✅ ${electronVersion} is installed`);
} catch (error) {
  console.error('\n❌ Electron is not installed. Please install it globally:');
  console.log('   npm install -g electron');
  process.exit(1);
}

console.log('\n✨ Build verification complete! You can now run:');
console.log('   npm run start:dev    # For development');
console.log('   npm run start:prod   # For production');
console.log('\nOr package the app with:');
console.log('   npm run package');
