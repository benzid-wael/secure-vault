// Test-only preload (see driver.cjs): reports whether the renderer it runs
// in is sandboxed. Never shipped; the driver registers it per run.
const { ipcRenderer } = require('electron');

ipcRenderer.send('e2e-sandboxed', process.sandboxed === true);
