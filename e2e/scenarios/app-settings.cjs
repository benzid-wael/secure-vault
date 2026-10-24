// Settings and remembered env vaults survive a restart (Task 23, Task 14):
// the seed is the earlier run; this run shows what it saved, and turning
// "remember" off deletes the kept list.
process.env.SECURE_VAULT_ENV_UI = '1';
const fs = require('fs');
const path = require('path');
const scenario = require('../driver.cjs');

scenario(async (t) => {
  const appData = path.dirname(t.VAULTS_DIR);
  const settingsFile = path.join(appData, 'app-settings.json');
  const recentsFile = path.join(appData, 'gui-env-recents.json');

  await t.click('Environments');
  t.check(
    'a vault opened in an earlier run is listed',
    await t.waitText('shop/.env.vault')
  );

  // Ctrl/Cmd+S opens Configuration, as the menu does.
  await t.js(
    "document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, metaKey: true }))"
  );
  t.check(
    'Configuration shows the app settings',
    await t.waitText('App settings')
  );
  t.check(
    'the idle time saved earlier is shown',
    await t.hasText('30 minutes without activity')
  );

  await t.click('Remember environment vaults I open');
  t.check(
    'turning remembering off says the list was cleared',
    await t.waitText('list of opened environment vaults was cleared')
  );
  t.check('the kept list is deleted', !fs.existsSync(recentsFile));
  const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  t.check(
    'the change is saved for the next run',
    saved.settings.rememberRecents === false &&
      saved.settings.idleMinutes === 30,
    JSON.stringify(saved)
  );
});
