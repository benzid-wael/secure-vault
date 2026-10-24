// Launched by the single-instance scenario: the app's main, started again
// with the same user data folder as the running scenario, as a second launch
// of the installed app would be.
const path = require('path');
const { app } = require('electron');

app.setPath(
  'userData',
  path.join(path.dirname(process.env.E2E_OUT), 'user-data')
);
require(path.join(process.env.E2E_REPO, 'build/electron/main.cjs'));
