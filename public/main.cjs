// CommonJS wrapper to bootstrap the ES module main process
// This file exists because Electron requires a CommonJS entry point

const path = require('path');
const { pathToFileURL } = require('url');

// Import the ES module version using file:// protocol
const mainModulePath = path.join(__dirname, 'main.js');
const mainModuleURL = pathToFileURL(mainModulePath).href;

import(mainModuleURL).catch(error => {
  console.error('Failed to load main module:', error);
  process.exit(1);
});
